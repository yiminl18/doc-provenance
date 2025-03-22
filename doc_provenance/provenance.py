from pdfminer.high_level import extract_text
import os,sys,nltk,time,json
import tiktoken
from doc_provenance import data_digestion
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

def merge_short_sentences(sentences, length = 30):
    merged = []
    i = 0
    n = len(sentences)
    
    while i < n:
        current = sentences[i]
        
        # If the sentence isn't short, just push it into merged
        if len(current) >= length:
            merged.append(current)
            i += 1
        
        else:
            # current sentence is short
            # Case A: If merged is empty and there's at least one more sentence, merge forward
            if not merged and i < n - 1:
                # Merge with the next sentence in the original list
                sentences[i + 1] = current + " " + sentences[i + 1]
                i += 1  # We skip adding current to merged
            # Case B: If it's the last sentence or there's no next to merge with
            elif i == n - 1:
                # If there's something in merged, merge with the last item in merged
                if merged:
                    merged[-1] = merged[-1] + " " + current
                else:
                    # Edge case: only one short sentence in the entire list
                    merged.append(current)
                i += 1
            else:
                # We have both a previous (in merged) and a next (in sentences)
                previous = merged[-1] if merged else ""  # Should not be empty logically here
                next_sent = sentences[i + 1]
                
                if len(previous) <= len(next_sent):
                    # Merge short sentence with previous
                    merged[-1] = previous + " " + current
                    i += 1
                else:
                    # Merge short sentence with next
                    sentences[i + 1] = current + " " + next_sent
                    i += 1
                # Notice we do not add `current` to `merged` because it was merged away

    return merged


def extract_sentences_from_pdf(text):
    sentences = nltk.sent_tokenize(text)
    sentences = merge_short_sentences(sentences)
    return sentences

def write_list_to_file(filename, lines):
    with open(filename, "w", encoding="utf-8") as file:
        file.writelines(f"{line}\n" for line in lines)

def write_string_to_file(filename, text):
    with open(filename, "w", encoding="utf-8") as file:
        file.write(text)

def write_json_to_file(filename, data):
    if len(filename) == 0:
        print(filename,'not exist!')
        return 
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
    #intruction = ' If answers are not found, return NULL.'
    #print(len(context))
    if len(context) == 0:
        return ['NULL'], 0, 0
    prompt = (question[0] + question[1], context)
    response = model(model_name, prompt)
    # print('Prompt is:', prompt[0])
    # print('QA response is:', response)
    if('|' in response):
        ans = [o.strip() for o in response.split('|')]
    else:
        ans = [response.strip()]
    input_tokens = count_tokens(question[0] + question[1] + context)
    output_tokens = count_tokens(response)
    return ans, input_tokens, output_tokens


def eval_equivelance_rules(s):
    if 'Kriiger' in s:
        s = s.replace('Kriiger','Krüger')
    s = s.strip('.')
    return s

def equal_string(res1, res2):
    if(len(res1) != len(res2)):
        return False
    res1_lower = []
    for r in res1:
        if 'null' in r.lower():
            return False
    for r in res2:
        if 'null' in r.lower():
            return False
    # print('before:',res1)
    # print('before:',res2)
    for r in res1:
        res1_lower.append(eval_equivelance_rules(r).lower())
        
    res2_lower = []
    for r in res2:
        res2_lower.append(eval_equivelance_rules(r).lower())
    # print('after:',res1_lower)
    # print('after:',res2_lower)
    for r in res1_lower:
        if r not in res2_lower:
            return False
    for r in res2_lower:
        if r not in res1_lower:
            return False
    return True

def equal(res1, res2, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    #print(len(res1), len(res2))
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        return equal_string(res1, res2)
    else:
        instruct_prompt = 'Determine if two strings are equivalent in meaning, not just in format. Lists must contain the same elements, allowing for alternative spellings, transliterations, or equivalent name variations. Missing or extra elements make them unequal. Dates in different formats should be considered equivalent if they represent the same time. Ignore case, punctuation, and spacing unless they change meaning. Return True if the strings are equivalent and False otherwise. Do not add explanations. ' 
        if equal_string(res1, res2):
            return True
        if len(res1) != len(res2):
            return False 
        if(len(res1) > 1 or len(res2) > 1):
            print('LLM evaluation1')
            instruction = instruct_prompt + ' String 1 is: ' + " ".join(res1) + ' String 2 is: ' + " ".join(res2)
            response = model(model_name, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False
        if(len(res1) == 1 and len(res2) == 1):
            str1 = res1[0]
            str2 = res2[0]
            if len(str1) > 2*len(str2) or len(str2) > 2*len(str1):
                print('length mis-match')
                return False
            print('LLM evaluation2')
            instruction = 'Given the following two strings, String 1 is: '  + res1[0] + '. String 2 is: ' + res2[0] + '. ' + instruct_prompt
            response = model(model_name, (instruction, ''))
            #print(instruction)
            if('true' in response.lower()):
                return True
            return False

def evaluate(answers, question, ids, sentences, context = '', metric = 'string'):
    ids = sorted(ids)
    if(context == ''):
        for id in ids:
            context += sentences[id]
    pred_ans, input_tokens, output_tokens = QA(question, context)
    #print(pred_ans, len(context), question)
    if(equal(pred_ans, answers, metric)):
        #print('True')
        return True, input_tokens, output_tokens
    else:
        #print('False')
        return False, input_tokens, output_tokens
    

def sequential_greedy_operator(question, answers, sentences, sorted_idx, metric = 'string'):
    #print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0

    #print(len(sentences))
    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    #print(sorted_idx)

    for i in sorted_idx:
        #print('Iterating sentence ',i, len(sorted_idx))
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
            #print('Sentence ',i, ' is removed!')
    provenance = []
    provenance_id = []
    for i in sorted_idx:
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    return provenance_id, (input_tokens, output_tokens)


def enumerate_skip_ids(cur_ids):
    new_len = len(cur_ids) * 2
    new_ids = []
    st_id = cur_ids[len(cur_ids)-1] + 1
    for i in range(new_len):
        new_ids.append(st_id)
        st_id += 1
    return new_ids

def exponential_greedy_operator(question, answers, sentences, sorted_idx, metric = 'string'):
    out = {}
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0

    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    #print(sorted_idx)

    skip_ids = []
    skip_ids.append(sorted_idx[0])
    i = 0

    while True:#iterate sentences stored in skip_ids to check if delete
        if skip_ids[0] > sorted_idx[len(sorted_idx)-1]:
            break
        remaining_sentences_id = []

        for i in sorted_idx:#get remaining sentences for evaluation
            if i in skip_ids:
                continue
            if i in removed_sentences:
                continue
            remaining_sentences_id.append(i)

        sorted_remaining_sentences_id = sorted(remaining_sentences_id)
        #print(sorted_remaining_sentences_id)
        
        eval_result, input_token, output_token = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        input_tokens += input_token
        output_tokens += output_token

        #print(skip_ids, eval_result)

        if eval_result == True:#if removing this sentence does not change the final answers, then these sentences can be removed 
            removed_sentences += skip_ids
            #get an exponential large skip_ids
            skip_ids = enumerate_skip_ids(skip_ids)
        else: #sentences in current skip ids cannot be removed 
            if len(skip_ids) == 1: #if an unit sentence cannot be removed, iterate the next sentence 
                skip_ids = [skip_ids[0] + 1]
            else:
                skip_ids = [skip_ids[0]] #reset to be the start of current skip ids, with initial step 


    provenance = []
    provenance_id = []
    for i in range(len(sentences)):
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    return provenance_id, (input_tokens, output_tokens)

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

def sort_sentences_by_similarity(question, answers, sentences, file_path):
    answer_str = ''.join(answers)
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

    return sorted_indices, similarity_scores

def embedding_sufficient_top_down_operator(question, answers, sentences, embedding_path, metric = 'string'):
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, sentences, embedding_path)
    #print(answers)
    queue = deque()
    queue.append(len(sorted_indices)/2)
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    while queue:
        current_k = int(queue.popleft())
        print(sorted_indices[:current_k])
        eval_result, input_tokens, output_tokens = evaluate(answers, question, sorted_indices[:current_k], sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            mid = current_k / 2
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return sorted_indices[:last_k], (sum_input_tokens, sum_output_tokens)
        else:
            return sorted_indices[:last_k], (sum_input_tokens, sum_output_tokens)
            
    return sorted_indices[:last_k], (sum_input_tokens, sum_output_tokens)

def embedding_sufficient_bottem_up_operator(question, answers, sentences, embedding_path, metric = 'string', step = 5):
    sorted_indices, similarity_scores = sort_sentences_by_similarity(question, answers, sentences, embedding_path)
    #print(answers)
    queue = deque()
    queue.append(len(sorted_indices))
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    current_sentences = []
    id = 0
    while id < len(sorted_indices):
        id += step
        current_sentences = sorted_indices[:id]
        eval_result, input_tokens, output_tokens = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            return current_sentences, (sum_input_tokens, sum_output_tokens)
    return list(range(len(sentences))), (sum_input_tokens, sum_output_tokens)

def divide_and_conquer_sufficient_operator(question, answers, sentences, sorted_idx, metric = 'string', stop_sentence_length = 5):
    #sorted_idx: the list of idx for the context to consider 
    sum_input_tokens = 0
    sum_output_tokens = 0

    father = {}
    rib = {}
    
    # A dictionary to cache evaluation results: { (ids_as_tuple): (eval_result, input_tokens, output_tokens) }
    eval_cache = {}
    st = time.time()
    
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
    
    stack = [sorted_idx]
    set_cached(sorted_idx, True)

    # current_ids has alredy been runed, set its status 
    #set_cached(ids, True)

    while stack:
        current_ids = stack.pop()
        

        # Evaluate the entire set once, storing the result
        if is_cached(current_ids) == 'NULL':
            eval_result, input_token, output_token = evaluate(answers, question, current_ids, sentences, metric = metric)
            sum_input_tokens += input_token
            sum_output_tokens += output_token
            set_cached(current_ids, eval_result)
        else:
            eval_result = is_cached(current_ids)

        print(current_ids, eval_result)
        # If the entire set doesn't yield True, no need to proceed

        tuple_current_ids = tuple(current_ids)
        if not eval_result:
            if tuple_current_ids in rib and tuple_current_ids in father:
                rib_node = rib[tuple_current_ids]
                father_node = father[tuple_current_ids]
                eval_rib = is_cached(list(rib_node))
                if eval_rib == 'NULL':
                    continue
                if not eval_rib:
                    #in this case, father node is true, but both childs are false, add father node into last_mile operator
                    return list(father_node), (sum_input_tokens, sum_output_tokens)
            continue
        if eval_result and len(current_ids) <= stop_sentence_length: #k is the length of sentences in the interval to stop iteration 
            return current_ids, (sum_input_tokens, sum_output_tokens)

        # Split the current subset into two halves
        mid = len(current_ids) // 2
        left = current_ids[:mid]
        right = current_ids[mid:]

        tuple_left = tuple(left)
        tuple_right = tuple(right)

        father[tuple_left] = tuple_current_ids
        father[tuple_right] = tuple_current_ids
        rib[tuple_left] = tuple_right
        rib[tuple_right] = tuple_left

        if is_cached(right) == 'NULL':
            stack.append(right)
        if is_cached(left) == 'NULL':
            stack.append(left) 

    return sorted_idx, (sum_input_tokens, sum_output_tokens)

def block_labeler(sentences, question, answers, blk_num):
    blocks = []
    blocks_sentences_id = []
    block_size = len(sentences)/blk_num
    bid = 0
    block = []
    ids = []
    #print(block_size)
    for i in range(len(sentences)):
        block.append(sentences[i])
        ids.append(i)
        bid += 1
        if(bid > block_size):
            bid = 0
            block_content = ''.join(block)
            blocks.append(block_content)
            blocks_sentences_id.append(ids)
            ids = []
            block = []
        else:
            if i == len(sentences) - 1:
                # add last block
                block_content = ''.join(block)
                blocks.append(block_content)
                blocks_sentences_id.append(ids)
    instruction = 'Given the following question: ' + question[0] + ' and a list of text blocks, the corresponding answers are: ' + ','.join(answers) +  '. Your task is to assign a score (from 1 to 10) to each block based on how likely it is to contain context relevant to answering the question. The text blocks are listed below, each starting with Block i: followed by its content. Return only a comma-separated list of scores corresponding to each block, in the order they are given. Do not include any explanations or additional text. '
    context = ''
    #print(len(blocks))
    for id in range(len(blocks)):
        context += 'Block ' + str(id) + ': ' + blocks[id] + '\n'
    prompt = (instruction, context)
    print(count_tokens(context))
    response = model(model_name, prompt)
    #print(response)
    scores = [int(num.strip()) for num in response.split(",")]
    block_scores = {}
    #print(scores)
    #print(len(scores), len(blocks), len(blocks_sentences_id))
    if len(scores) != len(blocks):
        #print('Labeler does not score for each block!') 
        id = 0
        while id < len(blocks):
            if id < len(scores):
                block_scores[id] = scores[id]
            else:
                block_scores[id] = 1
            id += 1
    else:
        #print('Labeler scores for each block!')
        for id in range(len(blocks)):
            block_scores[id] = scores[id]

    return block_scores, blocks_sentences_id

def get_block_sentences(block_list, blocks_sentences_id):
    sentences = []
    for block in block_list:
        senteces += blocks_sentences_id[block]
    return sentences

def LLM_score_sufficient_top_down_operator(question, answers, sentences, sorted_idx, metric = 'string', k=5):
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)
    # for id, score in block_scores.items():
    #     print(id, score)
    #     print(blocks_sentences_id[id])
    sorted_block = dict(sorted(block_scores.items(), key=lambda item: item[1]))

    queue = deque()
    queue.append(len(block_scores)/2)
    last_k = len(block_scores) 
    sum_input_tokens = 0
    sum_output_tokens = 0

    while queue:
        current_k = int(queue.popleft())
        #print(sorted_indices[:current_k])
        current_sentences = get_block_sentences(sorted_block[:current_k], blocks_sentences_id)
        eval_result, input_tokens, output_tokens = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            mid = current_k / 2
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return current_sentences, (sum_input_tokens, sum_output_tokens)
        else:
            return get_block_sentences(sorted_block[:last_k], blocks_sentences_id), (sum_input_tokens, sum_output_tokens)
        
    return sorted_idx, (sum_input_tokens, sum_output_tokens)

def LLM_score_sufficient_bottem_up_operator(question, answers, sentences, sorted_idx, metric = 'string', k=5):
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)
    sorted_block = dict(sorted(block_scores.items(), key=lambda item: item[1]))
    current_block = []
    for block in sorted_block:
        current_block += block
        current_sentences = get_block_sentences(current_block, blocks_sentences_id)
        eval_result, input_tokens, output_tokens = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            return current_sentences, (sum_input_tokens, sum_output_tokens)
        
    return sorted_idx, (sum_input_tokens, sum_output_tokens)

def caller(question, answers, sentences, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = 'string', embedding_path = ''):
    sufficient_provenance_ids = []
    sufficient_input_tokens = 0
    sufficient_output_tokens = 0

    if find_sufficient_provenance_strategy == 'raw':
        sufficient_provenance_ids = list(range(len(sentences)))
    elif find_sufficient_provenance_strategy == 'embedding_sufficient_top_down':
        sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens) = embedding_sufficient_top_down_operator(question, answers, sentences, metric = metric)
    elif find_sufficient_provenance_strategy == 'embedding_sufficient_bottem_up':
        sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens) = embedding_sufficient_bottem_up_operator(question, answers, sentences, embedding_path, metric = metric)
    elif find_sufficient_provenance_strategy == 'divide_and_conquer_sufficient':
        sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens) = divide_and_conquer_sufficient_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)
    elif find_sufficient_provenance_strategy == 'LLM_score_sufficient_top_down':
        sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens) = LLM_score_sufficient_top_down_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)
    elif find_sufficient_provenance_strategy == 'LLM_score_sufficient_bottem_up':
        sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens) = LLM_score_sufficient_bottem_up_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)

    minimal_provenance_ids = []
    minimal_input_tokens = 0
    minimal_output_tokens = 0
    if find_minimal_provenance_strategy == 'sequential_greedy':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens) = sequential_greedy_operator(question, answers, sufficient_provenance_ids, metric = metric)
    elif find_minimal_provenance_strategy == 'exponential_greedy':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens) = exponential_greedy_operator(question, answers, sentences, sufficient_provenance_ids, metric = metric)
    elif find_minimal_provenance_strategy == 'null':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens) = sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens)

    return minimal_provenance_ids, (sufficient_input_tokens + minimal_input_tokens, sufficient_output_tokens + minimal_output_tokens)

def logger(text, question, title, path, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = 'string', embedding_path = ''):
    logs = {}
    logs['title'] = title
    logs['question'] = question
    logs['document_size'] = count_tokens(text)
    sentences = extract_sentences_from_pdf(text)
    answers, in_token, out_tokens = QA(question, text)
    st = time.time()
    provenance_ids, (input_tokens, output_tokens) =  caller(question, answers, sentences, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = metric, embedding_path=embedding_path)
    et = time.time()
    logs['answer'] = answers
    logs['time'] = et-st
    provenance_ids = sorted(provenance_ids)
    logs['provenance_ids'] = provenance_ids
    provenance = []
    for id in provenance_ids:
        provenance.append(sentences[id])
    logs['provenance'] = provenance
    logs['provenance_size'] = count_tokens(''.join(provenance))
    logs['tokens'] = (input_tokens, output_tokens)

    write_json_to_file(path, logs)

    print(provenance_ids)
    print(input_tokens, output_tokens)
    return logs 

