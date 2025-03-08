from pdfminer.high_level import extract_text
import os,sys,nltk,time,json
import tiktoken
import data_digestion
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import pandas as pd
from openai import OpenAI
client = OpenAI()
embedding_model = "text-embedding-3-small"
from collections import deque

nltk.download("punkt")

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model #[gpt4o, gpt4vision, gpt4omini]
model_name = 'gpt4omini'

def extract_text_from_pdf(pdf_path):
    return extract_text(pdf_path)

def extract_sentences_from_pdf(text):
    # Split text into sentences using nltk
    sentences = nltk.sent_tokenize(text)
    # Alternatively, a regex-based approach
    # sentences = re.split(r'(?<=[.!?])\s+', text)
    return sentences

def write_list_to_file(filename, lines):
    with open(filename, "w", encoding="utf-8") as file:
        file.writelines(f"{line}\n" for line in lines)

def write_string_to_file(filename, text):
    with open(filename, "w", encoding="utf-8") as file:
        file.write(text)

def write_json_to_file(filename, data):
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)


def create_data_folder(path):
    data_path = path.replace('data','out').replace('.pdf','')
    os.makedirs(data_path, exist_ok=True)
    return data_path

def count_tokens(text, model="gpt-4o-mini"):
    encoder = tiktoken.encoding_for_model(model)  # Get the tokenizer for the specific model
    tokens = encoder.encode(text)  # Encode text into tokens
    return len(tokens)


def QA(question, context):
    prompt = (question[0] + question[1], context)
    response = model(model_name, prompt)
    if('|' in response):
        ans = [o.strip() for o in response.split('|')]
    else:
        ans = [response.strip()]
    input_tokens = count_tokens(question[0] + question[1] + context)
    output_tokens = count_tokens(response)
    return ans, input_tokens, output_tokens

def equal(res1, res2, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    print(len(res1), len(res2))
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        if(len(res1) != len(res2)):
            return False
        res1_lower = []
        for r in res1:
            res1_lower.append(r)
        res2_lower = []
        for r in res2:
            res2_lower.append(r)
        for r in res1_lower:
            if r not in res2_lower:
                return False
        for r in res2_lower:
            if r not in res1_lower:
                return False
        return True
    else:
        if(len(res1) > 1 or len(res2) > 1):
            instruction = 'Given the following two lists of strings, determine whether they are equivalent. Equivalence is defined as being mostly semantically similar, even if they do not match exactly. For example, 2017/02 should be considered the same as 2017 Feb. If the two lists are equivalent, return True; otherwise, return False. List 1 is: ' + " ".join(res1) + ' List 2 is: ' + " ".join(res2) 
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False
        if(len(res1) == 1 and len(res2) == 1):
            instruction = 'Given the following two strings, '  + res1[0] + ', ' + res2[0] + '. Determine whether they are equivalent. Equivalence is defined as being mostly semantically similar, even if they do not match exactly. For example, 2017/02 should be considered the same as 2017 Feb. If the two strings are equivalent, return True; otherwise, return False.'
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False

def evaluate(answers, question, ids, sentences, context = '', metric = 'string'):
    ids = sorted(ids)
    if(context == ''):
        for id in ids:
            context += sentences[id]
    #print('tokens:', count_tokens(context))
    #print('context:',context[:10])
    #print(len(ids))
    #print(ids)
    pred_ans, input_tokens, output_tokens = QA(question, context)
    print(pred_ans)
    print(answers)
    if(equal(pred_ans, answers, metric)):
        #print('True')
        return True, input_tokens, output_tokens
    else:
        #print('False')
        return False, input_tokens, output_tokens

def vallina_LLM(question, context, title, path):
    answers, input_tokens, output_tokens = QA(question,context)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(context)
    
    st = time.time()
    """
        Directly invoke LLM to return the provenance of ``answers'' to ``question'' in a given ``context''
    """
    instruction = 'Given the following question: ' + question[0] + ', the corresponding answers are: ' + ','.join(answers) +  '. Your task is to extract the set of sentences from the provided context that contribute to generating these answers. Identify the most relevant sentences that support the given answers. Make sure these sentences are raw sentences from the document. Do not add explanations. Do not create new words or sentences. The context is as follows: '
    prompt = (instruction, context)
    response = model(model_name, prompt)
    et = time.time()
    out['time'] = et-st
    out['provenance'] = response
    out['provenance_size'] = count_tokens(response)
    input_tokens = count_tokens(instruction + context)
    output_tokens = count_tokens(response)
    out['tokens'] = (input_tokens, output_tokens)
    write_json_to_file(path, out)
    return out

def sequential_greedy(question, context, title, path, metric = 'string'):
    st = time.time()
    out = sequential_greedy_score(question, context, title, metric = metric)
    et = time.time()
    out['time'] = et-st
    out['path'] = path
    write_json_to_file(path, out)

    return out 

def sequential_greedy_score(question, context, title, sorted_idx = [], metric = 'string'):
    print(metric)
    answers, input_tokens, output_tokens = QA(question,context)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['context_size'] = count_tokens(context)

    sentences = extract_sentences_from_pdf(context)
    print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0

    #print(len(sentences))
    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    print(sorted_idx)

    for i in sorted_idx:
        print('Iterating sentence ',i, len(sorted_idx))
        #print(sentences[i])
        remaining_sentences_id = []
        for j in sorted_idx:
            if j in removed_sentences:
                continue
            if i == j:
                continue
            remaining_sentences_id.append(j)

        sorted_remaining_sentences_id = sorted(remaining_sentences_id)
        
        eval_result, input_token, output_token = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        input_tokens += input_token
        output_tokens += output_token
        if eval_result == True:#if removing this sentence does not change the final answers, then this sentence can be removed 
            removed_sentences.append(i) 
            print('Sentence ',i, ' is removed!')
    provenance = []
    provenance_id = []
    for i in sorted_idx:
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id 

    return out 

binary_out_ids = []
sum_input_tokens = 0
sum_output_tokens = 0

def divide_and_conquer(question, text, title, path,metric = 'string'):
    global binary_out_ids,sum_input_tokens,sum_output_tokens
    sum_input_tokens = 0
    sum_output_tokens = 0
    binary_out_ids = []
    answers, input_tokens, output_tokens = QA(question,text)
    print(answers)

    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    out['context_size'] = count_tokens(text)

    st = time.time()
    ids = []
    sentences = extract_sentences_from_pdf(text)
    for i in range(len(sentences)):
        ids.append(i)
    divide_and_conquer_iterative_with_cache(answers, question, ids, sentences, metric)
    binary_out_ids = list(set(binary_out_ids))
    binary_out_ids = sorted(binary_out_ids)
    #print(binary_out_ids)
    et = time.time()
    out['time'] = et-st
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = binary_out_ids 
    provenance = []
    for id in binary_out_ids:
        provenance.append(sentences[id])
    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    write_json_to_file(path, out)




def divide_and_conquer_iterative_with_cache(answers, question, ids, sentences, metric = 'string'):
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a divide-and-conquer approach but in a non-recursive (queue-based) way.
    Adds a caching mechanism to avoid re-evaluating the same subsets.
    
    Returns:
        True if the entire input `ids` subset is True under `evaluate`,
        False otherwise.
    
    Side-effects:
        - Appends to the global list `binary_out_ids` those IDs that
          we deem necessary.
        - Accumulates token usage in `sum_input_tokens` and `sum_output_tokens`.
    """
    global binary_out_ids, sum_input_tokens, sum_output_tokens
    
    # A dictionary to cache evaluation results: { (ids_as_tuple): (eval_result, input_tokens, output_tokens) }
    eval_cache = {}
    
    def is_cached(sub_ids):
        """
        A helper function to wrap 'evaluate', storing and retrieving results from 'eval_cache'.
        """
        # Convert the list of IDs to a tuple so it can be used as a dictionary key
        key = tuple(sub_ids)
        
        # Return cached result if we already have it
        if key in eval_cache:
            return eval_cache[key]
        
        return 'NULL'
    
    def set_cached(sub_ids, result):
        key = tuple(sub_ids)
        eval_cache[key] = result 

    # Use a queue to perform an iterative, divide-and-conquer approach
    queue = deque()
    queue.append(ids)

    while queue:
        current_ids = queue.popleft()

        # Evaluate the entire set once, storing the result
        if is_cached(current_ids) == 'NULL':
            eval_result, input_token, output_token = evaluate(answers, question, current_ids, sentences, metric)
            sum_input_tokens += input_token
            sum_output_tokens += output_token
            set_cached(current_ids, eval_result)
        else:
            eval_result = is_cached(current_ids)

        print(current_ids, eval_result)
        # If the entire set doesn't yield True, no need to proceed
        if not eval_result:
            continue
        if eval_result and len(current_ids) <= 1:
            binary_out_ids += current_ids
            continue

        # Split the current subset into two halves
        mid = len(current_ids) // 2
        left = current_ids[:mid]
        right = current_ids[mid:]

        # Evaluate left and right subsets (using cache)
        if is_cached(left) == 'NULL':
            eval_result_left, input_token_left, output_token_left = evaluate(answers, question, left, sentences, metric)
            sum_input_tokens += input_token_left
            sum_output_tokens += output_token_left
            set_cached(left, eval_result_left)
        else:
            eval_result_left = is_cached(left)

        if is_cached(right) == 'NULL':
            eval_result_right, input_token_right, output_token_right = evaluate(answers, question, right, sentences, metric)
            sum_input_tokens += input_token_right
            sum_output_tokens += output_token_right
            set_cached(right, eval_result_right)
        else:
            eval_result_right = is_cached(right)

        # If both halves fail individually (False) but the entire set was True,
        # we consider the whole subset as necessary and skip further splitting
        if (not eval_result_left) and (not eval_result_right) and eval_result:
            binary_out_ids += current_ids
            continue
        
        if(eval_result_left):
            queue.append(left)
        if(eval_result_right):
            queue.append(right)

def cosine_sim(vec1, vec2):
    return cosine_similarity([vec1], [vec2])[0][0]

def get_embedding(text, model=embedding_model):
    text = text.replace("\n", " ")
    return client.embeddings.create(input = [text], model=model).data[0].embedding

def save_embeddings(filename, embeddings):
    # Extract the directory from the filename
    directory = os.path.dirname(filename)
    
    # Check if the directory exists; if not, create it
    if directory and not os.path.exists(directory):
        os.makedirs(directory)
    
    # Save the embeddings to the specified file
    np.save(filename, embeddings)

def load_embeddings(filename):
    return np.load(filename, allow_pickle=True).item()

def sort_sentences_by_similarity(question, answers, text, file_path):
    #print(question)
    #print(answers)
    answer_str = ''.join(answers)
    sentences = extract_sentences_from_pdf(text)
    # Get embedding for the question and answers
    
    question_embedding = get_embedding(question[0] + ' ' + answer_str)
    
    exist = False

    try:
        # Load existing embeddings
        embeddings = load_embeddings(file_path)
        exist = True
        #print('load')
    except FileNotFoundError:
        embeddings = {}
    
    # Compute embeddings and similarity scores for each sentence
    similarity_scores = {}
    for sentence in sentences:
        if sentence not in embeddings:
            embeddings[sentence] = get_embedding(sentence)
        sentence_embedding = embeddings[sentence]
        similarity = cosine_sim(question_embedding, sentence_embedding)
        similarity_scores[sentence] = similarity

    # Save updated embeddings
    if not exist:
        save_embeddings(file_path, embeddings)

    # Pair each sentence with its index and similarity score
    indexed_sentences = list(enumerate(sentences))

    # Sort sentences based on similarity scores in descending order
    sorted_indexed_sentences = sorted(indexed_sentences, key=lambda x: similarity_scores[x[1]], reverse=True)

    # Extract the sorted sentences and their original indices
    sorted_sentences = [sentence for index, sentence in sorted_indexed_sentences]
    sorted_indices = [index for index, sentence in sorted_indexed_sentences]

    # Output the sorted sentences and their original indices
    # for idx, sentence in zip(sorted_indices, sorted_sentences):
    #     print(f"Original Index: {idx}, Sentence: '{sentence}', similarity: '{similarity_scores[sentence]}'")

    # for idx in sorted_indices[:20]:
    #     print(idx, sentences[idx], similarity_scores[sentences[idx]])

    return sorted_indices, similarity_scores

def pick_k_binary(question, text, sorted_indices, metric = 'LLM'):
    answers, input_tokens, output_tokens = QA(question,text)
    #print(answers)
    sentences = extract_sentences_from_pdf(text)
    queue = deque()
    queue.append(len(sorted_indices))
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    while queue:
        current_k = int(queue.popleft())
        #print(sorted_indices[:current_k])
        eval_result, input_tokens, output_tokens = evaluate(answers, question, sorted_indices[:current_k], sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            mid = current_k / 2
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return last_k, sum_input_tokens, sum_output_tokens
        else:
            return last_k, sum_input_tokens, sum_output_tokens
            
    return last_k, sum_input_tokens, sum_output_tokens

def heuristic_topk(question, text, title, result_path, embedding_path, metric = 'LLM'):
    # print(embedding_path)
    # print(result_path)
    answers, in_tokens, out_tokens = QA(question, text)
    out = {}
    st = time.time() 
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, text, embedding_path)
    k, input_tokens, output_tokens = pick_k_binary(question, text, sorted_indices, metric = metric)
    #print(sorted_indices)
    et = time.time()
    out['time'] = et-st
    out['k'] = k 
    out['tokens'] = (input_tokens, output_tokens)
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['context_size'] = count_tokens(text)

    provenance_ids = sorted_indices[:k]
    provenance = []
    sentences = extract_sentences_from_pdf(text)
    print(k,len(sentences))

    for id in provenance_ids:
        provenance.append(sentences[id])

    out['provenance'] = provenance
    out['provenance_size'] = count_tokens(''.join(provenance))
    out['provenance_ids'] = provenance_ids 

    write_json_to_file(result_path, out)
    return out

def heuristic_greedy(question, text, title, result_path, embedding_path, metric = 'string'):
    print(embedding_path)
    print(result_path)
    answers = QA(question, text)
    st = time.time()
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, text, embedding_path)
    k, extra_input_tokens, extra_output_tokens = pick_k_binary(question, text, sorted_indices, metric = metric)
    #print(k, len(sorted_indices))
    out = sequential_greedy_score(question, text, title, sorted_idx = sorted_indices[:k])
    et = time.time()
    out['time'] = et-st
    out['k'] = k 
    (input_tokens, output_tokens) = out['tokens']
    out['tokens'] = (input_tokens + extra_input_tokens, output_tokens + extra_output_tokens)

    write_json_to_file(result_path, out)
    return out

def read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

def verification(metric='string'):
    data_path = parent_directory + '/out/papers/results/'
    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy']

    doc_num = 4
    q_num = 3
    runs = {}
    for d_id in range(doc_num):
        for q_id in range(q_num):
            #this is one run 
            for strategy in strategies:
                file_path = data_path + 'doc' + str(d_id) + '_q' + str(q_id) + '_' + strategy + '.json'
                result = read_json(file_path)
                if strategy not in runs:
                    runs[strategy] = []
                runs[strategy].append(result) 

    for strategy in strategies:
        accuracy = 0
        if strategy == 'vallina_LLM':
            for o in runs[strategy]:
                print(o['path'])
                answers = o['answers']
                if isinstance(o['provenance'], list):
                    provenance = "".join(o['provenance'])
                else:
                    provenance = o['provenance']
                question = o['question']
                print(answers, question)
                eval, in_tokens, out_tokens = evaluate(answers, question, [],[], context=provenance, metric='string')
                

        #print(strategy, accuracy, len(runs[strategy]))
        

def test_paper_pipeline():
    data_path = parent_directory + '/data/papers.json'
    folder_path = parent_directory + '/out/papers'
    paper_objects = data_digestion.digest_paper_dataset(data_path)
    sample_paper_questions = data_digestion.sample_paper_questions()

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy','heuristic_topk']
    strategy = 'heuristic_topk'
    doc_num = 5

    for q_id in range(len(sample_paper_questions)):
        q = sample_paper_questions[q_id]
        for p_id in range(len(paper_objects)):
            paper = paper_objects[p_id]
            path = folder_path + '/results/' + 'doc' + str(p_id) + '_q' + str(q_id) + '_' + strategy + '.json'
            if p_id != 4 or q_id != 2:
                continue
            # if os.path.isfile(path):
            #     continue
            if(p_id >= doc_num):
                break
            text = paper['text']
            title = paper['title']
            print(title,q)
            embedding_path = folder_path + '/embeddings/' + 'doc' + str(p_id) + '_embeddings.npy'
            if strategy == 'vallina_LLM':
                vallina_LLM(q, text, title, path)
            elif strategy == 'sequential_greedy':
                sequential_greedy(q, text, title, path) 
            elif strategy == 'divide_and_conquer': 
                divide_and_conquer(q, text, title, path)
            elif strategy == 'heuristic_greedy':
                heuristic_greedy(q, text, title, path, embedding_path) 
            elif strategy == 'heuristic_topk':
                heuristic_topk(q, text, title, path, embedding_path)
    
            #break
        #break

def test_hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = parent_directory + '/out/hotpotQA'
    hotpot_objects = data_digestion.digest_hotpotQA_dataset(data_path)

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer','heuristic_greedy','heuristic_topk']
    strategy = 'heuristic_topk'
    num_of_case = 10

    i = -1
    for e in hotpot_objects:
        i += 1
        question = e['question']
        instruction = e['instruction']
        q = (question, instruction)
        text = e['context']
        title = e['document_name']
        path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + strategy + '.json'
        if not os.path.exists(folder_path + '/results'):
            os.makedirs(folder_path + '/results')
        # if os.path.isfile(path):
        #     continue
        # if i != 5:
        #     continue
        #print(question)
        embedding_path = folder_path + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
        if strategy == 'vallina_LLM':
            vallina_LLM(q, text, title, path)
        elif strategy == 'sequential_greedy':
            sequential_greedy(q, text, title, path, metric = 'LLM') 
        elif strategy == 'divide_and_conquer': 
            divide_and_conquer(q, text, title, path)
        elif strategy == 'heuristic_greedy':
            heuristic_greedy(q, text, title, path, embedding_path) 
        elif strategy == 'heuristic_topk':
            heuristic_topk(q, text, title, path, embedding_path)
        #break
        if(i > num_of_case):
            break


if __name__ == "__main__":
    test_paper_pipeline()
    #test_hotpot_pipeline()