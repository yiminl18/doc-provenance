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
from difflib import SequenceMatcher

nltk.download("punkt")

question = ''
embedding_sentence_block_size = 1

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model 
model_expensive = ''
model_cheap = ''


def set_model(model_name):
    global model_cheap
    global model_expensive
    model_cheap = model_name
    model_expensive = 'gpt4o'

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

def str_similarity(str1, str2):
    similarity = SequenceMatcher(None, str1, str2).ratio()
    return similarity

def extract_sentences_from_pdf(text):
    sentences = nltk.sent_tokenize(text)
    sentences = merge_short_sentences(sentences)
    return sentences

def group_sentences(sentences, k = 5):
    #merge k sentneces into a group
    merged_sentences = []
    id_mp = {}
    i = 1
    group_sentence = []
    sid = 0
    sids = []
    gid = 0
    for sentence in sentences:
        #print(i,k)
        if i > k:
            id_mp[gid] = sids
            merged_sentences.append(' '.join(group_sentence))
            i = 1
            group_sentence = []
            sids = []
            gid += 1
        group_sentence.append(sentence)
        sids.append(sid)
        if sid == len(sentences)-1: #last set of sentences 
            id_mp[gid] = sids
            merged_sentences.append(' '.join(group_sentence))
        i += 1
        sid += 1
    return merged_sentences, id_mp

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
    #print(len(context))
    if len(context) == 0:
        return ['NULL'], 0, 0
    prompt = (question[0] + question[1], context)
    #print('Prompt:', prompt[0], prompt[1])
    response = model(model_cheap, prompt)
    
    #print('QA response is:', response)
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
    print(model_cheap, model_expensive)
    for r in res1:
        if 'null' in r.lower():
            return False
    for r in res2:
        if 'null' in r.lower():
            return False
    if(len(res1) != len(res2)):
        return False
    res1_lower = []
    # print('before:',res1)
    # print('before:',res2)
    for r in res1:
        res1_lower.append(eval_equivelance_rules(r).lower())
        
    res2_lower = []
    for r in res2:
        res2_lower.append(eval_equivelance_rules(r).lower())

    if len(res1_lower) == 1 and len(res2_lower) == 1:
        str1 = res1_lower[0]
        str2 = res2_lower[0]
        #print('str_similarity:', str_similarity(str1, str2))
        if len(str1) > 20 and len(str2) > 20 and str_similarity(str1, str2) > 0.9:
            return True

    for r in res1_lower:
        if r not in res2_lower:
            return False
    for r in res2_lower:
        if r not in res1_lower:
            return False
    return True

        
def equal(res1, res2, question, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    #print(len(res1), len(res2))
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        return equal_string(res1, res2)
    else:
        #check NULL answer
        for r in res1:
            if 'null' in r.lower():
                return False
        for r in res2:
            if 'null' in r.lower():
                return False
        instruction = 'I have two answers to the given question. If these two answers are equivalent in meaning, return True; otherwise, return False. Do not provide any explanation. ' + 'Answer 1: ' + ''.join(res1) + ' Answer 2: ' + ''.join(res2) + ' Question: ' + question[0] 
        if equal_string(res1, res2):
            #print('Return true in string metric')
            return True
        if len(res1) != len(res2):
            return False 
        if(len(res1) > 1 or len(res2) > 1):
            #print('LLM evaluation with different lengths')
            response = model(model_expensive, (instruction, ''))
            if('true' in response.lower()):
                return True
            return False
        if(len(res1) == 1 and len(res2) == 1):
            str1 = res1[0]
            str2 = res2[0]
            # if len(str1) > 2*len(str2) or len(str2) > 2*len(str1):
            #     print('length mis-match')
            #     return False
            # if len(str1) < 20 and len(str2) < 20: 
            #     #print('Evaluated in string')
            #     return equal_string(res1, res2)
            response = model(model_expensive, (instruction, ''))
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
    print('predicted answer:', pred_ans)
    print('original answer:', answers)
    #print('metric:', metric)
    st = time.time()
    if(equal(pred_ans, answers, question, metric)):
        et = time.time()
        #print('True')
        return True, input_tokens, output_tokens, et-st
    else:
        et = time.time()
        #print('False')
        return False, input_tokens, output_tokens, et-st
    

def sequential_greedy_operator(question, answers, sentences, sorted_idx, metric = 'string'):
    #print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0
    total_eval_latency = 0

    #print(len(sentences))
    if len(sorted_idx) == 0:
        sorted_idx = list(range(len(sentences)))

    #print(sorted_idx)

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
        
        eval_result, input_token, output_token, eval_latency = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        total_eval_latency += eval_latency
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

    return provenance_id, (input_tokens, output_tokens), total_eval_latency


def enumerate_skip_ids(cur_ids):
    new_len = len(cur_ids) * 2
    new_ids = []
    st_id = cur_ids[len(cur_ids)-1] + 1
    for i in range(new_len):
        new_ids.append(st_id)
        st_id += 1
    return new_ids

def exponential_greedy_operator(question, answers, sentences, sorted_idx, metric = 'string'):
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0
    total_eval_latency = 0

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
        print('skip_ids:', skip_ids)
        
        eval_result, input_token, output_token, eval_latency = evaluate(answers, question, sorted_remaining_sentences_id, sentences, metric = metric)
        print('eval:', eval_result)
        total_eval_latency += eval_latency
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
    for i in sorted_idx:
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    return provenance_id, (input_tokens, output_tokens), total_eval_latency

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
        print('Embeddings found!')
        exist = True
    except FileNotFoundError:
        print('Embedding not found!')
        embeddings = {}
    
    # Compute embeddings and similarity scores for each sentence
    similarity_scores = {}
    id_mp = {}
    i = 0
    sentences, id_mp = group_sentences(sentences, k = 5)
    for sentence in sentences:
        #print(i)
        if sentence not in embeddings:
            embeddings[sentence] = get_embedding(sentence)
        sentence_embedding = embeddings[sentence]
        similarity = cosine_sim(question_embedding, sentence_embedding)
        similarity_scores[sentence] = similarity
        i += 1

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

    return sorted_indices, similarity_scores, sentences, id_mp

def embedding_sufficient_top_down_operator(question, answers, sentences, embedding_path, metric = 'string'):
    sorted_indices, similarity_scores, group_sentences, id_mp = sort_sentences_by_similarity(question, answers, sentences, embedding_path)
    # for idx in sorted_indices[:20]:
    #     print(idx, group_sentences[idx], similarity_scores[group_sentences[idx]])
    #     print(id_mp[idx])
    
    total_eval_latency = 0
    queue = deque()
    queue.append(len(sorted_indices)/2)
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    while queue:
        current_k = int(queue.popleft())
        current_sentences = []
        for i in sorted_indices[:current_k]:
            current_sentences += id_mp[i]
        print(current_k, current_sentences)
        eval_result, input_tokens, output_tokens, eval_latency = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        print(eval_result)
        total_eval_latency += eval_latency
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        #print('last_k:', last_k)
        if eval_result:
            mid = round(current_k / 2)
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return current_sentences, (sum_input_tokens, sum_output_tokens),total_eval_latency
        else:
            out_sentences = []
            for i in sorted_indices[:last_k]:
                out_sentences += id_mp[i]
            return out_sentences, (sum_input_tokens, sum_output_tokens),total_eval_latency
            
    #return sorted_indices[:last_k], (sum_input_tokens, sum_output_tokens),total_eval_latency

def embedding_sufficient_bottem_up_operator(question, answers, sentences, embedding_path, metric = 'string', step = 1):
    sorted_indices, similarity_scores, group_sentences, id_mp = sort_sentences_by_similarity(question, answers, sentences, embedding_path)
    #print(answers)
    # for idx in sorted_indices[:20]:
    #     #print(idx, group_sentences[idx], similarity_scores[group_sentences[idx]])
    #     print(id_mp[idx])
    total_eval_latency = 0
    queue = deque()
    queue.append(len(sorted_indices))
    last_k = len(sorted_indices)
    sum_input_tokens = 0
    sum_output_tokens = 0

    current_sentences = []
    id = 0
    while id < len(sorted_indices):
        id += step
        current_sentences = []
        for i in sorted_indices[:id]:
            current_sentences += id_mp[i]
        eval_result, input_tokens, output_tokens, eval_latency = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        print(current_sentences, eval_result)
        total_eval_latency += eval_latency
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            return current_sentences, (sum_input_tokens, sum_output_tokens),total_eval_latency
    return list(range(len(sentences))), (sum_input_tokens, sum_output_tokens),total_eval_latency

def divide_and_conquer_sufficient_operator(question, answers, sentences, sorted_idx, metric = 'string', stop_sentence_length = 5):
    #sorted_idx: the list of idx for the context to consider 
    sum_input_tokens = 0
    sum_output_tokens = 0
    total_eval_latency = 0 
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
            eval_result, input_token, output_token, eval_latency = evaluate(answers, question, current_ids, sentences, metric = metric)
            total_eval_latency += eval_latency
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
                    return list(father_node), (sum_input_tokens, sum_output_tokens),total_eval_latency
            continue
        if eval_result and len(current_ids) <= stop_sentence_length: #k is the length of sentences in the interval to stop iteration 
            return current_ids, (sum_input_tokens, sum_output_tokens),total_eval_latency

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

    return sorted_idx, (sum_input_tokens, sum_output_tokens),total_eval_latency

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
    #print(instruction)
    #print(len(blocks))
    for id in range(len(blocks)):
        context += 'Block ' + str(id) + ': ' + blocks[id] + '\n'
    #print(len(context))
    prompt = (instruction, context)
    #print(count_tokens(context))
    response = model(model_expensive, prompt)
    response = response.strip()
    print(response)
    if response.endswith(","):
        response = response[:-1]
    print(response)
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

def get_block_sentences(block_list):
    sentences = []
    for block in block_list:
        sentences += block 
    return sentences

def LLM_score_sufficient_top_down_operator(question, answers, sentences, sorted_idx, metric = 'string', k=5):
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    print('block number:',blk_num)
    total_eval_latency = 0
    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)
    # for id, score in block_scores.items():
    #     print(id, score)
    #     print(blocks_sentences_id[id])
    sorted_block_dict = dict(sorted(block_scores.items(), key=lambda item: item[1], reverse=True))
    sorted_block = []
    for id, score in sorted_block_dict.items():
        # print(id, score)
        # print(blocks_sentences_id[id])
        sorted_block.append(blocks_sentences_id[id])


    queue = deque()
    queue.append(len(block_scores)/2)
    last_k = len(block_scores) 
    sum_input_tokens = 0
    sum_output_tokens = 0
    #print('block_size:',len(block_scores))

    while queue:
        current_k = int(queue.popleft())
        print('k:',current_k)
        # print(sorted_block[:current_k])
        current_sentences = get_block_sentences(sorted_block[:current_k])
        # print('current sentences:', current_sentences)
        eval_result, input_tokens, output_tokens, eval_latency = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        total_eval_latency += eval_latency
        print('eval:', eval_result)
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            mid = current_k / 2
            queue.append(mid)
            last_k = current_k
            if current_k <= 1:
                return current_sentences, (sum_input_tokens, sum_output_tokens),total_eval_latency
        else:
            return get_block_sentences(sorted_block[:last_k]), (sum_input_tokens, sum_output_tokens),total_eval_latency
        
    return sorted_idx, (sum_input_tokens, sum_output_tokens)

def LLM_score_sufficient_bottem_up_operator(question, answers, sentences, sorted_idx, metric = 'string', k=5):
    blk_num = len(sentences)/k
    blk_num = min(20, blk_num)
    total_eval_latency = 0
    sum_input_tokens = 0
    sum_output_tokens = 0

    block_scores, blocks_sentences_id = block_labeler(sentences, question, answers, blk_num)
    sorted_block_dict = dict(sorted(block_scores.items(), key=lambda item: item[1], reverse=True))
    sorted_block = []
    for id, score in sorted_block_dict.items():
        # print(id, score)
        # print(blocks_sentences_id[id])
        sorted_block.append(blocks_sentences_id[id])
    current_block = []
    for k in range(1,len(sorted_block)):
        current_block = sorted_block[:k]
        print('k, current_block:', k, current_block)
        current_sentences = get_block_sentences(current_block)
        #print('current_sentences:', current_sentences)
        eval_result, input_tokens, output_tokens, eval_latency = evaluate(answers, question, current_sentences, sentences, context = '', metric = metric)
        print('eval:', eval_result)
        total_eval_latency += eval_latency
        sum_input_tokens += input_tokens
        sum_output_tokens += output_tokens
        if eval_result:
            return current_sentences, (sum_input_tokens, sum_output_tokens),total_eval_latency
        
    return sorted_idx, (sum_input_tokens, sum_output_tokens),total_eval_latency


def LLM_vanilla(question, context, title, path, model_name):
    # print(question)
    # answers, input_tokens, output_tokens = QA(question,context)
    answers = ['Officer Christopher Messick']
    #print(answers)
    answers_str = ''.join(answers)
    if 'null' in answers_str.lower():
        out = {}
        out['status'] = 'NA'
        write_json_to_file(path, out)
        return out 
    
    out = {}
    out['title'] = title
    out['question'] = question
    out['answers'] = answers
    out['context_size'] = count_tokens(context)
    
    st = time.time()
    """
        Directly invoke LLM to return the provenance of ``answers'' to ``question'' in a given ``context''
    """
    instruction = 'Given the following question: ' + question[0] + ', the corresponding answers are: ' + ','.join(answers) +  '. Your task is to extract the set of sentences from the provided context that contribute to generating these answers. Identify the most relevant sentences that support the given answers. Make sure these sentences are raw sentences from the document. Do not add explanations. Do not create new words or sentences. The context is as follows: '
    prompt = (instruction, context)
    response = model(model_name, prompt)
    print(response)
    et = time.time()
    out['time'] = et-st
    out['provenance'] = response
    out['provenance_size'] = count_tokens(response)
    input_tokens = count_tokens(instruction + context)
    output_tokens = count_tokens(response)
    out['tokens'] = (input_tokens, output_tokens)
    #write_json_to_file(path, out)
    return out

def caller(question, answers, sentences, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = 'string', embedding_path = '', sufficient_time = -1, sufficient_tokens = (-1,-1), sufficient_provenance_ids = [-1], sufficient_eval_latency  = -1):
    
    sufficient_input_tokens = 0
    sufficient_output_tokens = 0
    sufficient_eval_latency = 0

    if sufficient_time == -1:
        print('Compute sufficient provenance online')
        #print('Starting:', find_sufficient_provenance_strategy)
        sufficient_provenance_ids = []
        if find_sufficient_provenance_strategy == 'raw':
            sufficient_provenance_ids = list(range(len(sentences)))
        elif find_sufficient_provenance_strategy == 'embedding_sufficient_top_down':
            sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens), sufficient_eval_latency = embedding_sufficient_top_down_operator(question, answers, sentences, embedding_path, metric = metric)
        elif find_sufficient_provenance_strategy == 'embedding_sufficient_bottem_up':
            sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens), sufficient_eval_latency = embedding_sufficient_bottem_up_operator(question, answers, sentences, embedding_path, metric = metric)
        elif find_sufficient_provenance_strategy == 'divide_and_conquer_sufficient':
            sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens), sufficient_eval_latency = divide_and_conquer_sufficient_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)
        elif find_sufficient_provenance_strategy == 'LLM_score_sufficient_top_down':
            sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens), sufficient_eval_latency = LLM_score_sufficient_top_down_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)
        elif find_sufficient_provenance_strategy == 'LLM_score_sufficient_bottem_up':
            sufficient_provenance_ids, (sufficient_input_tokens, sufficient_output_tokens), sufficient_eval_latency = LLM_score_sufficient_bottem_up_operator(question, answers, sentences, list(range(len(sentences))), metric = metric)
    else: 
        print('Read sufficient provenance locally')
        sufficient_input_tokens = sufficient_tokens[0]
        sufficient_output_tokens = sufficient_tokens[1]
        sufficient_eval_latency = sufficient_eval_latency


    print('sufficient provenance ids:', sufficient_provenance_ids)
    
    minimal_provenance_ids = []
    minimal_input_tokens = 0
    minimal_output_tokens = 0
    minimal_eval_latency = 0 

    print('Starting:', find_minimal_provenance_strategy)

    if find_minimal_provenance_strategy == 'sequential_greedy':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens), minimal_eval_latency = sequential_greedy_operator(question, answers, sentences, sufficient_provenance_ids, metric = metric)
    elif find_minimal_provenance_strategy == 'exponential_greedy':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens), minimal_eval_latency = exponential_greedy_operator(question, answers, sentences, sufficient_provenance_ids, metric = metric)
    elif find_minimal_provenance_strategy == 'null':
        minimal_provenance_ids, (minimal_input_tokens, minimal_output_tokens), minimal_eval_latency = sufficient_provenance_ids, (0, 0), 0
    print('sufficient tokens:', (sufficient_input_tokens, sufficient_output_tokens) )
    print('minimal_tokens:', (minimal_input_tokens, minimal_output_tokens))
    return minimal_provenance_ids, (sufficient_input_tokens + minimal_input_tokens, sufficient_output_tokens + minimal_output_tokens), sufficient_eval_latency + minimal_eval_latency

def logger(text, q, title, model_name, path, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = 'string', embedding_path = '', sufficient_time = -1, sufficient_tokens = (-1,-1), sufficient_provenance_ids = [-1], sufficient_eval_latency = -1):     
    set_model('gpt4o')
    print('used models:', model_cheap, model_expensive)
    global question
    question = q 
    logs = {} 
    logs['title'] = title
    logs['question'] = question
    logs['document_size'] = count_tokens(text)
    sentences = extract_sentences_from_pdf(text)

    if find_sufficient_provenance_strategy == 'LLM_vanilla':
        LLM_vanilla(question, text, title, path, model_name)
        return 
    
    if sufficient_provenance_ids[0] == -1:
        answers, in_token, out_tokens = QA(question, text)
    else:
        context = ''
        for sid in sufficient_provenance_ids:
            context += sentences[sid]
        answers, in_token, out_tokens = QA(question, context)
    
    answers_str = ''.join(answers)
    print('answers:', answers)
    print('sufficient id size:', len(sufficient_provenance_ids))
    if 'null' in answers_str.lower():
        logs['answer'] = answers
        logs['status'] = 'NA'#null answers
        write_json_to_file(path, logs)
        return logs 
    print(len(answers_str))
    if len(answers_str) > 300:
        logs['status'] = 'LA'#long answers
        write_json_to_file(path, logs)
        return logs 
    if len(sufficient_provenance_ids) > 100:
        print('Sufficient does not prune much, skip')
        logs['status'] = 'SL'#sufficient large
        write_json_to_file(path, logs)
        return logs

    st = time.time()
    provenance_ids, (input_tokens, output_tokens), eval_latency =  caller(question, answers, sentences, find_sufficient_provenance_strategy, find_minimal_provenance_strategy, metric = metric, embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
    et = time.time()
    logs['answer'] = answers
    logs['time'] = et-st
    print('minimal time:', logs['time'], 'sufficient time:', sufficient_time)
    if sufficient_time != -1:# if sufficient provenance has been computed 
        logs['time'] += sufficient_time
    logs['eval_time'] = eval_latency
    provenance_ids = sorted(provenance_ids)
    logs['provenance_ids'] = provenance_ids
    provenance = []
    for id in provenance_ids:
        provenance.append(sentences[id])
    logs['provenance'] = provenance
    logs['provenance_size'] = count_tokens(''.join(provenance))
    logs['tokens'] = (input_tokens, output_tokens)

    write_json_to_file(path, logs)

    print('provenance ids:', provenance_ids)
    #print('provenance time:', logs['time'])
    print(input_tokens, output_tokens)
    return logs 

if __name__ == "__main__":
    pdf_path = '/Users/yiminglin/Documents/Codebase/doc-provenance/tests/data/police_records/1715882251765-owf-1.pdf'
    out_path = '/Users/yiminglin/Documents/Codebase/doc-provenance/tests/out/1715882251765-owf-1.json' 

    question = 'What are the names of police officers who used force with both a Baton and Knee before February 10? Only return the officer names. Exclude explanation. ' 

    pdf_text = extract_text_from_pdf(pdf_path)
    set_model('gpt4o')
    LLM_vanilla(question, pdf_text, '1715882251765-owf-1', out_path, 'gpt4o')

    
