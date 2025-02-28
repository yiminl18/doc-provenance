from pdfminer.high_level import extract_text
import os,sys,nltk,time,json
import tiktoken
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


def QA(question, context, type = 'list'):
    prompt = (question[0] + question[1], context)
    response = model(model_name, prompt)
    if(type == 'list'):
        ans = [o.strip() for o in response.split('|')]
    else:
        ans = [response.strip()]
    input_tokens = count_tokens(question[0] + question[1] + context)
    output_tokens = count_tokens(response)
    return ans, input_tokens, output_tokens

def equal(res1, res2, metric = 'string'):
    res1 = sorted(res1)
    res2 = sorted(res2)
    #res1 and res2 are both list of strings 
    if(metric == 'string'):
        if(res1 != res2):
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


def vallina_LLM(answers, question, context, path):
    out = {}
    out['question'] = question
    out['answers'] = answers
    out['path'] = path

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
    input_tokens = count_tokens(instruction + context)
    output_tokens = count_tokens(response)
    out['tokens'] = (input_tokens, output_tokens)
    write_json_to_file(path, out)
    return out

def sequential_greedy(question, context, path, type = 'list'):
    answers, input_tokens, output_tokens = QA(question,context,type)
    print(answers)

    out = {}
    out['question'] = question
    out['answers'] = answers
    out['path'] = path

    st = time.time()

    sentences = extract_sentences_from_pdf(context)
    print('Number of sentences:', len(sentences)) 
    removed_sentences = []
    input_tokens = 0
    output_tokens = 0
    for i in range(len(sentences)):
        print('Iterating sentence ',i, len(sentences))
        print(sentences[i])
        remaining_sentences_id = []
        for j in range(len(sentences)):
            if j in removed_sentences:
                continue
            if i == j:
                continue
            remaining_sentences_id.append(j)
        
        eval_result, input_token, output_token = evaluate(answers, question, remaining_sentences_id, sentences, type = type)
        input_tokens += input_token
        output_tokens += output_token
        if eval_result == True:#if removing this sentence does not change the final answers, then this sentence can be removed 
            removed_sentences.append(i) 
            print('Sentence ',i, ' is removed!')
    provenance = []
    provenance_id = []
    for i in range(len(sentences)):
        if i in removed_sentences:
            continue
        provenance_id.append(i)
        provenance.append(sentences[i])

    et = time.time()
    out['time'] = et-st
    out['provenance'] = provenance
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id 
    write_json_to_file(path, out)

    return out 
    
def evaluate(answers, question, ids, sentences, type = 'list'):
    context = ''
    print(ids)
    for id in ids:
        context += sentences[id]
    pred_ans, input_tokens, output_tokens = QA(question, context, type)
    print(pred_ans)
    print(answers)
    if(equal(pred_ans, answers)):
        return True, input_tokens, output_tokens
    else:
        return False, input_tokens, output_tokens

def divide_and_conquer(answers, question, text, path, type = 'list'):
    out = {}
    out['question'] = question
    out['answers'] = answers
    out['path'] = path
    st = time.time()
    ids = []
    sentences = extract_sentences_from_pdf(text)
    for i in range(len(sentences)):
        ids.append(i)
    provenance_id, input_tokens, output_tokens = divide_and_conquer_core(answers, question, ids, sentences, type)
    et = time.time()
    out['time'] = et-st
    out['tokens'] = (input_tokens, output_tokens)
    out['provenance_ids'] = provenance_id 
    provenance = []
    for id in provenance_id:
        provenance.append(sentences[id])
    out['provenance'] = provenance
    write_json_to_file(path, out)


def divide_and_conquer_core(answers, question, ids, sentences, type = 'list'):
    
    """
    Attempt to find a smaller subset of `sentences` that returns True for H,
    using a simple divide-and-conquer approach.
    
    Returns a (not guaranteed fully minimal) subset for which H is still True.
    """
    # If the entire set somehow doesn't trigger True, nothing to return
    eval_result, input_token, output_token = evaluate(answers, question, ids, sentences, type)
    # Start accumulating total token usage
    sum_input_tokens = input_token
    sum_output_tokens = output_token
    if not eval_result:
        return [], sum_input_tokens, sum_output_tokens
    
    # If there's only 0 or 1 sentence, we can't reduce further
    if len(ids) <= 1:
        return ids,sum_input_tokens,sum_output_tokens
    
    # Split into two halves
    mid = len(ids) // 2
    left = ids[:mid]
    right = ids[mid:]
    
    left_sub = None
    right_sub = None
    
    # Check if the left half alone satisfies H
    eval_result_left, input_token, output_token = evaluate(answers, question, left, sentences, type = type)
    # Accumulate tokens
    sum_input_tokens += input_token
    sum_output_tokens += output_token

    # Check if the right half alone satisfies H
    eval_result_right, input_token, output_token = evaluate(answers, question, right, sentences, type = type)
    sum_input_tokens += right_in_tokens
    sum_output_tokens += right_out_tokens

    if (not eval_result_left) and (not eval_result_right):
        return ids, sum_input_tokens, sum_output_tokens
    elif eval_result_left and (not eval_result_right):
        left_sub, left_in_tokens, left_out_tokens = divide_and_conquer_core(answers, question, left, sentences, type)
        return left_sub, sum_input_tokens + left_in_tokens, sum_output_tokens + left_out_tokens
    elif (not eval_result_left) and eval_result_right:
        right_sub, right_in_tokens, right_out_tokens = divide_and_conquer_core(answers, question, right, sentences, type)
        return right_sub, sum_input_tokens + right_in_tokens, sum_output_tokens + right_out_tokens
    else: #left and right are both true, which won't happen if G is not empty 
        left_sub, left_in_tokens, left_out_tokens = divide_and_conquer_core(answers, question, left, sentences, type)
        right_sub, right_in_tokens, right_out_tokens = divide_and_conquer_core(answers, question, right, sentences, type)
        sum_input_tokens += (left_in_tokens + right_in_tokens)
        sum_output_tokens += (left_out_tokens + right_out_tokens)

        combined = left_sub + right_sub
        eval_result, input_token, output_token = evaluate(answers, question, combined, sentences, type = type)
        if(eval_result):
            return divide_and_conquer_core(answers, question, combined, sentences, type)
        else:
            return ids, sum_input_tokens, sum_output_tokens
    

if __name__ == "__main__":
    data_path = parent_directory + '/data/https:www.malibucity.org:AgendaCenter:ViewFile:Agenda:_05252022-1908 (dragged).pdf'
    folder_path = create_data_folder(data_path)
    question = ('What the capitol improvement projects starting later than 2022?',' Return only the names of project, seperated by |.')
    text = extract_text_from_pdf(data_path)
    

    strategies = ['vallina_LLM','sequential_greedy','divide_and_conquer']
    strategy = 'sequential_greedy'
    path = folder_path + '/' + strategy + '.json'
    if strategy == 'vallina_LLM':
        vallina_LLM(question, text, path)
    elif strategy == 'sequential_greedy':
        sequential_greedy(question, text, path, type = 'list') 
    elif strategy == 'divide_and_conquer': 
        divide_and_conquer(question, text, path, type = 'list')
        
    